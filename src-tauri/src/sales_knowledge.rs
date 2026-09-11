use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub(crate) const MAX_PDF_BYTES: u64 = 25 * 1024 * 1024;
const MAX_PAGES: usize = 500;
const MAX_TEXT_CHARS: usize = 2_000_000;
const MAX_CHUNKS: usize = 2_000;
const MAX_CHUNK_CHARS: usize = 4_000;
const INDEX_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeSource {
    id: String,
    title: String,
    kind: String,
    created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeSourceVersion {
    source_id: String,
    sha256: String,
    byte_size: u64,
    page_count: usize,
    chunk_count: usize,
    index_version: u8,
    created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeChunk {
    id: String,
    source_id: String,
    source_sha256: String,
    source_title: String,
    page_start: usize,
    page_end: usize,
    location: String,
    heading: Option<String>,
    tags: Vec<String>,
    text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeIndexFile {
    source: KnowledgeSource,
    version: KnowledgeSourceVersion,
    chunks: Vec<KnowledgeChunk>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegistryEntry {
    source: KnowledgeSource,
    current_version: KnowledgeSourceVersion,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedKnowledgeSource {
    source: KnowledgeSource,
    version: KnowledgeSourceVersion,
    deduplicated: bool,
}

fn valid_id(value: &str) -> bool {
    let mut characters = value.chars();
    matches!(characters.next(), Some(first) if first.is_ascii_lowercase())
        && (2..=80).contains(&value.len())
        && characters.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn plain_field(value: &str, max: usize) -> Option<String> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    (!normalized.is_empty() && normalized.chars().count() <= max && !normalized.contains('\0'))
        .then_some(normalized)
}

fn knowledge_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("sales-knowledge"))
        .map_err(|_| "Could not locate sales knowledge storage.".into())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Knowledge storage path is invalid.".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "Could not create knowledge storage.".to_string())?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("knowledge"),
        uuid::Uuid::new_v4()
    ));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "Could not prepare knowledge storage.".to_string())?;
        file.write_all(bytes)
            .map_err(|_| "Could not write knowledge storage.".to_string())?;
        file.sync_all()
            .map_err(|_| "Could not sync knowledge storage.".to_string())?;
        std::fs::rename(&temporary, path)
            .map_err(|_| "Could not publish knowledge storage.".to_string())?;
        #[cfg(unix)]
        std::fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "Could not finalize knowledge storage.".to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

fn normalize_page(value: &str) -> String {
    let mut output = String::new();
    let mut previous_blank = false;
    for raw in value.replace('\0', "").lines() {
        let line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            if !output.is_empty() && !previous_blank {
                output.push_str("\n\n");
            }
            previous_blank = true;
        } else {
            if !output.is_empty() && !output.ends_with('\n') {
                output.push(' ');
            }
            output.push_str(&line);
            previous_blank = false;
        }
    }
    output.trim().to_string()
}

fn heading_prefix(value: &str) -> Option<String> {
    let line = value.lines().next()?.trim();
    let words = line.split_whitespace().take(12).collect::<Vec<_>>();
    let uppercase = words
        .iter()
        .take_while(|word| {
            let letters = word
                .chars()
                .filter(|character| character.is_alphabetic())
                .collect::<String>();
            !letters.is_empty() && letters == letters.to_uppercase()
        })
        .copied()
        .collect::<Vec<_>>();
    (uppercase.len() >= 2)
        .then(|| {
            uppercase
                .join(" ")
                .trim_matches(|character: char| !character.is_alphanumeric())
                .to_string()
        })
        .filter(|heading| !heading.is_empty() && heading.len() <= 160)
}

fn split_bounded(value: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for paragraph in value
        .split("\n\n")
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        let mut remainder = paragraph;
        while !remainder.is_empty() {
            let available = MAX_CHUNK_CHARS.saturating_sub(current.chars().count());
            if available == 0 {
                chunks.push(std::mem::take(&mut current));
                continue;
            }
            if remainder.chars().count() <= available {
                if !current.is_empty() {
                    current.push_str("\n\n");
                }
                current.push_str(remainder);
                break;
            }
            let byte_end = remainder
                .char_indices()
                .nth(available)
                .map_or(remainder.len(), |(index, _)| index);
            let candidate = &remainder[..byte_end];
            let split = candidate
                .rfind(['.', '?', '!', '\n'])
                .map(|index| index + 1)
                .filter(|index| *index >= available / 2)
                .unwrap_or(byte_end);
            if !current.is_empty() {
                current.push_str("\n\n");
            }
            current.push_str(remainder[..split].trim());
            chunks.push(std::mem::take(&mut current));
            remainder = remainder[split..].trim();
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn extract_pages_from_owned_copy(root: &Path, bytes: &[u8]) -> Result<Vec<String>, String> {
    std::fs::create_dir_all(root).map_err(|_| "Could not create knowledge storage.".to_string())?;
    let path = root.join(format!(".parse-{}.pdf", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "Could not prepare the PDF for parsing.".to_string())?;
        file.write_all(bytes)
            .map_err(|_| "Could not prepare the PDF for parsing.".to_string())?;
        file.sync_all()
            .map_err(|_| "Could not prepare the PDF for parsing.".to_string())?;
        let pages = pdf_extract::extract_text_by_pages(&path)
            .map_err(|_| "The PDF is encrypted, malformed, or unreadable.".to_string())?;
        if pages.iter().any(|page| !page.trim().is_empty()) {
            return Ok(pages);
        }
        let document = lopdf::Document::load(&path)
            .map_err(|_| "The PDF is encrypted, malformed, or unreadable.".to_string())?;
        if document.is_encrypted() {
            return Err("The PDF is encrypted, malformed, or unreadable.".to_string());
        }
        document
            .get_pages()
            .keys()
            .map(|page| {
                document
                    .extract_text(&[*page])
                    .map_err(|_| "The PDF text could not be extracted.".to_string())
            })
            .collect()
    })();
    let _ = std::fs::remove_file(path);
    result
}

fn chunks_from_pages(
    pages: &[String],
    source: &KnowledgeSource,
    sha256: &str,
) -> Result<Vec<KnowledgeChunk>, String> {
    let mut chunks = Vec::new();
    let mut total_characters = 0usize;
    for (page_index, page) in pages.iter().enumerate() {
        let normalized = normalize_page(page);
        total_characters = total_characters.saturating_add(normalized.chars().count());
        if total_characters > MAX_TEXT_CHARS {
            return Err("The PDF contains too much extracted text.".into());
        }
        if normalized.is_empty() {
            continue;
        }
        let heading = heading_prefix(&normalized);
        for text in split_bounded(&normalized) {
            if chunks.len() == MAX_CHUNKS {
                return Err("The PDF produces too many knowledge chunks.".into());
            }
            let number = chunks.len() + 1;
            chunks.push(KnowledgeChunk {
                id: format!("{}:{number:04}", source.id),
                source_id: source.id.clone(),
                source_sha256: sha256.into(),
                source_title: source.title.clone(),
                page_start: page_index + 1,
                page_end: page_index + 1,
                location: format!("Page {}", page_index + 1),
                heading: heading.clone(),
                tags: Vec::new(),
                text,
            });
        }
    }
    if chunks.is_empty() {
        return Err("The PDF does not contain readable text.".into());
    }
    Ok(chunks)
}

fn version_directory(root: &Path, source_id: &str, hash: &str) -> Result<PathBuf, String> {
    if !valid_id(source_id) || !valid_hash(hash) {
        return Err("Knowledge source reference is invalid.".into());
    }
    Ok(root.join("sources").join(source_id).join(hash))
}

fn read_registry_from_root(root: &Path) -> Result<Vec<RegistryEntry>, String> {
    match std::fs::read(root.join("registry.json")) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "Knowledge registry is malformed.".into())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err("Could not read knowledge registry.".into()),
    }
}

fn validate_index(
    index: KnowledgeIndexFile,
    source_id: &str,
    hash: &str,
) -> Result<KnowledgeIndexFile, String> {
    if index.source.id != source_id
        || index.source.kind != "pdf"
        || index.version.source_id != source_id
        || index.version.sha256 != hash
        || index.version.index_version != INDEX_VERSION
        || index.version.chunk_count != index.chunks.len()
        || index.version.page_count == 0
        || index.version.page_count > MAX_PAGES
        || index.chunks.is_empty()
        || index.chunks.len() > MAX_CHUNKS
    {
        return Err("Knowledge index provenance is invalid.".into());
    }
    if index.chunks.iter().any(|chunk| {
        chunk.source_id != source_id
            || chunk.source_sha256 != hash
            || chunk.page_start == 0
            || chunk.page_end < chunk.page_start
            || chunk.page_end > index.version.page_count
            || chunk.text.is_empty()
            || chunk.text.chars().count() > MAX_CHUNK_CHARS
    }) {
        return Err("Knowledge index chunks are invalid.".into());
    }
    Ok(index)
}

fn read_index_from_root(
    root: &Path,
    source_id: &str,
    hash: &str,
) -> Result<Option<KnowledgeIndexFile>, String> {
    let path = version_directory(root, source_id, hash)?.join("index.json");
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "Knowledge index is malformed.".to_string())
            .and_then(|index| validate_index(index, source_id, hash))
            .map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Could not read knowledge index.".into()),
    }
}

fn publish_registry(
    root: &Path,
    source: &KnowledgeSource,
    version: &KnowledgeSourceVersion,
) -> Result<(), String> {
    let mut registry = read_registry_from_root(root)?;
    if let Some(existing) = registry.iter().find(|entry| entry.source.id == source.id) {
        if existing.source.title != source.title {
            return Err("This knowledge source ID already has a different title.".into());
        }
    }
    registry.retain(|entry| entry.source.id != source.id);
    registry.push(RegistryEntry {
        source: source.clone(),
        current_version: version.clone(),
    });
    registry.sort_by(|left, right| left.source.title.cmp(&right.source.title));
    let json = serde_json::to_vec_pretty(&registry)
        .map_err(|_| "Could not encode knowledge registry.".to_string())?;
    atomic_write(&root.join("registry.json"), &json)
}

fn import_pdf_to_root(
    path: &Path,
    root: &Path,
    source_id: &str,
    title: &str,
    created_at: &str,
) -> Result<ImportedKnowledgeSource, String> {
    if !valid_id(source_id) {
        return Err("Knowledge source ID is invalid.".into());
    }
    let title =
        plain_field(title, 200).ok_or_else(|| "Knowledge source title is invalid.".to_string())?;
    let created_at = plain_field(created_at, 40)
        .ok_or_else(|| "Knowledge source timestamp is invalid.".to_string())?;
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("pdf"))
        != Some(true)
    {
        return Err("Choose a PDF file.".into());
    }
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| "Could not read the selected PDF.".to_string())?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > MAX_PDF_BYTES {
        return Err("The selected PDF is not a supported size.".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "Could not read the selected PDF.".to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_PDF_BYTES {
        return Err("The selected PDF is not a supported size.".into());
    }
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let source = KnowledgeSource {
        id: source_id.into(),
        title,
        kind: "pdf".into(),
        created_at: created_at.clone(),
    };
    let directory = version_directory(root, source_id, &sha256)?;
    if let Some(index) = read_index_from_root(root, source_id, &sha256)? {
        publish_registry(root, &index.source, &index.version)?;
        return Ok(ImportedKnowledgeSource {
            source: index.source,
            version: index.version,
            deduplicated: true,
        });
    }
    let pages = extract_pages_from_owned_copy(root, &bytes)?;
    if pages.is_empty() || pages.len() > MAX_PAGES {
        return Err("The PDF has an unsupported page count.".into());
    }
    let chunks = chunks_from_pages(&pages, &source, &sha256)?;
    let version = KnowledgeSourceVersion {
        source_id: source_id.into(),
        sha256: sha256.clone(),
        byte_size: bytes.len() as u64,
        page_count: pages.len(),
        chunk_count: chunks.len(),
        index_version: INDEX_VERSION,
        created_at,
    };
    let index = validate_index(
        KnowledgeIndexFile {
            source: source.clone(),
            version: version.clone(),
            chunks,
        },
        source_id,
        &sha256,
    )?;
    let source_parent = directory
        .parent()
        .ok_or_else(|| "Knowledge storage path is invalid.".to_string())?;
    std::fs::create_dir_all(source_parent)
        .map_err(|_| "Could not create knowledge source storage.".to_string())?;
    let staging = source_parent.join(format!(".{sha256}.{}.tmp", uuid::Uuid::new_v4()));
    let publication: Result<(), String> = (|| {
        std::fs::create_dir(&staging)
            .map_err(|_| "Could not prepare knowledge source storage.".to_string())?;
        atomic_write(&staging.join("source.pdf"), &bytes)?;
        atomic_write(
            &staging.join("index.json"),
            &serde_json::to_vec_pretty(&index)
                .map_err(|_| "Could not encode knowledge index.".to_string())?,
        )?;
        atomic_write(&staging.join("methodology.json"), b"[]")?;
        #[cfg(unix)]
        std::fs::File::open(&staging)
            .and_then(|folder| folder.sync_all())
            .map_err(|_| "Could not sync knowledge source storage.".to_string())?;
        std::fs::rename(&staging, &directory)
            .map_err(|_| "Could not publish knowledge source version.".to_string())?;
        #[cfg(unix)]
        std::fs::File::open(source_parent)
            .and_then(|folder| folder.sync_all())
            .map_err(|_| "Could not finalize knowledge source version.".to_string())?;
        Ok(())
    })();
    if publication.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    publication?;
    publish_registry(root, &source, &version)?;
    Ok(ImportedKnowledgeSource {
        source,
        version,
        deduplicated: false,
    })
}

#[tauri::command]
pub async fn import_sales_knowledge_pdf(
    app: AppHandle,
    path: String,
    source_id: String,
    title: String,
    created_at: String,
) -> Result<ImportedKnowledgeSource, String> {
    let root = knowledge_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        import_pdf_to_root(Path::new(&path), &root, &source_id, &title, &created_at)
    })
    .await
    .map_err(|_| "Knowledge import task failed.".to_string())?
}

#[tauri::command]
pub fn list_sales_knowledge_sources(app: AppHandle) -> Result<String, String> {
    serde_json::to_string(&read_registry_from_root(&knowledge_root(&app)?)?)
        .map_err(|_| "Could not encode knowledge registry.".into())
}

#[tauri::command]
pub fn read_sales_knowledge_version(
    app: AppHandle,
    source_id: String,
    version_hash: String,
) -> Result<String, String> {
    let root = knowledge_root(&app)?;
    let Some(index) = read_index_from_root(&root, &source_id, &version_hash)? else {
        return Ok(String::new());
    };
    let methodology_path =
        version_directory(&root, &source_id, &version_hash)?.join("methodology.json");
    let frameworks: serde_json::Value = match std::fs::read(methodology_path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "Knowledge methodology metadata is malformed.".to_string())?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => serde_json::json!([]),
        Err(_) => return Err("Could not read knowledge methodology metadata.".into()),
    };
    let mut value =
        serde_json::to_value(index).map_err(|_| "Could not encode knowledge index.".to_string())?;
    value
        .as_object_mut()
        .ok_or_else(|| "Knowledge index is invalid.".to_string())?
        .insert("frameworks".into(), frameworks);
    serde_json::to_string(&value).map_err(|_| "Could not encode knowledge index.".into())
}

#[cfg(test)]
mod tests {
    use super::{import_pdf_to_root, read_index_from_root, read_registry_from_root, MAX_PDF_BYTES};
    use std::path::Path;

    fn pdf_fixture(pages: &[&str]) -> Vec<u8> {
        let mut objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            format!(
                "<< /Type /Pages /Kids [{}] /Count {} >>",
                (0..pages.len())
                    .map(|index| format!("{} 0 R", 3 + index * 2))
                    .collect::<Vec<_>>()
                    .join(" "),
                pages.len()
            ),
        ];
        for (index, text) in pages.iter().enumerate() {
            let page_id = 3 + index * 2;
            let content_id = page_id + 1;
            objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents {content_id} 0 R >>"));
            let escaped = text
                .replace('\\', "\\\\")
                .replace('(', "\\(")
                .replace(')', "\\)");
            let stream = format!("BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET");
            objects.push(format!(
                "<< /Length {} >>\nstream\n{}\nendstream",
                stream.len(),
                stream
            ));
        }
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = vec![0usize];
        for (index, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", index + 1, object).as_bytes());
        }
        let xref = pdf.len();
        pdf.extend_from_slice(
            format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
        );
        for offset in offsets.iter().skip(1) {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                objects.len() + 1
            )
            .as_bytes(),
        );
        pdf
    }

    fn write_fixture(dir: &Path, name: &str, pages: &[&str]) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, pdf_fixture(pages)).unwrap();
        path
    }

    #[test]
    fn imports_bounded_pdf_with_page_provenance_and_deduplicates() {
        let temp = tempfile::tempdir().unwrap();
        let source = write_fixture(
            temp.path(),
            "source.pdf",
            &[
                "OPENING FRAMEWORK First useful paragraph.",
                "OBJECTIONS Ask one diagnostic question.",
            ],
        );
        let first = import_pdf_to_root(
            &source,
            temp.path(),
            "source-one",
            "Source One",
            "2026-09-11T00:00:00.000Z",
        )
        .unwrap();
        assert!(!first.deduplicated);
        assert_eq!(first.version.page_count, 2);
        let index = read_index_from_root(temp.path(), "source-one", &first.version.sha256)
            .unwrap()
            .unwrap();
        assert!(index
            .chunks
            .iter()
            .any(|chunk| chunk.page_start == 1
                && chunk.heading.as_deref() == Some("OPENING FRAMEWORK")));
        assert!(index
            .chunks
            .iter()
            .any(|chunk| chunk.page_start == 2 && chunk.text.contains("diagnostic question")));
        let again = import_pdf_to_root(
            &source,
            temp.path(),
            "source-one",
            "Source One",
            "2026-09-11T00:00:01.000Z",
        )
        .unwrap();
        assert!(again.deduplicated);
        assert_eq!(again.version.sha256, first.version.sha256);
        assert_eq!(read_registry_from_root(temp.path()).unwrap().len(), 1);
    }

    #[test]
    fn rejects_wrong_extension_unsafe_id_and_oversized_file() {
        let temp = tempfile::tempdir().unwrap();
        let wrong = write_fixture(temp.path(), "source.txt", &["Readable text"]);
        assert!(import_pdf_to_root(
            &wrong,
            temp.path(),
            "source-one",
            "Source",
            "2026-09-11T00:00:00.000Z"
        )
        .is_err());
        let pdf = write_fixture(temp.path(), "source.pdf", &["Readable text"]);
        assert!(import_pdf_to_root(
            &pdf,
            temp.path(),
            "../outside",
            "Source",
            "2026-09-11T00:00:00.000Z"
        )
        .is_err());
        let large = temp.path().join("large.pdf");
        std::fs::File::create(&large)
            .unwrap()
            .set_len(MAX_PDF_BYTES + 1)
            .unwrap();
        assert!(import_pdf_to_root(
            &large,
            temp.path(),
            "large-source",
            "Large",
            "2026-09-11T00:00:00.000Z"
        )
        .is_err());
        assert!(!temp
            .path()
            .join("sources")
            .join("..")
            .join("outside")
            .exists());
    }

    #[test]
    fn corrupt_or_empty_pdf_never_publishes_partial_state() {
        let temp = tempfile::tempdir().unwrap();
        let good = write_fixture(temp.path(), "good.pdf", &["Useful content for retrieval"]);
        import_pdf_to_root(
            &good,
            temp.path(),
            "good-source",
            "Good",
            "2026-09-11T00:00:00.000Z",
        )
        .unwrap();
        let before = std::fs::read(temp.path().join("registry.json")).unwrap();
        let corrupt = temp.path().join("corrupt.pdf");
        std::fs::write(&corrupt, b"not a pdf").unwrap();
        assert!(import_pdf_to_root(
            &corrupt,
            temp.path(),
            "bad-source",
            "Bad",
            "2026-09-11T00:00:00.000Z"
        )
        .is_err());
        assert_eq!(
            std::fs::read(temp.path().join("registry.json")).unwrap(),
            before
        );
        assert!(
            read_index_from_root(temp.path(), "missing-source", &"a".repeat(64))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    #[ignore = "imports user-supplied books only when explicit environment paths are provided"]
    fn imports_supplied_books_into_application_data() {
        let root = std::env::var_os("SALES_KNOWLEDGE_IMPORT_ROOT")
            .map(std::path::PathBuf::from)
            .expect("SALES_KNOWLEDGE_IMPORT_ROOT");
        let objections = std::env::var_os("SALES_KNOWLEDGE_OBJECTIONS_PDF")
            .map(std::path::PathBuf::from)
            .expect("SALES_KNOWLEDGE_OBJECTIONS_PDF");
        let execution = std::env::var_os("SALES_KNOWLEDGE_EXECUTION_PDF")
            .map(std::path::PathBuf::from)
            .expect("SALES_KNOWLEDGE_EXECUTION_PDF");
        let first = import_pdf_to_root(
            &objections,
            &root,
            "objections-jeb-blount",
            "Objections",
            "2026-09-11T00:00:00.000Z",
        )
        .unwrap();
        let second = import_pdf_to_root(
            &execution,
            &root,
            "cold-calling-sucks",
            "Cold Calling Sucks",
            "2026-09-11T00:00:00.000Z",
        )
        .unwrap();
        assert!(first.version.page_count > 100 && first.version.chunk_count > 50);
        assert!(second.version.page_count > 100 && second.version.chunk_count > 50);
        assert_eq!(read_registry_from_root(&root).unwrap().len(), 2);
    }
}
