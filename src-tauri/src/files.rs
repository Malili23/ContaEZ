use std::{fs::OpenOptions, io::Write, path::{Path, PathBuf}};

struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
}

/// Stage beside the destination so the final rename stays on the same volume.
/// Never truncate the destination before the complete replacement is ready.
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let temporary_path = path.with_extension(format!("contaez-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary_path).map_err(|e| format!("No se pudo preparar la copia: {e}"))?;
    let temporary = TemporaryFile(temporary_path);
    let staged=file.write_all(data).and_then(|_| file.sync_all());
    // Windows also requires that the staging handle be closed before renaming.
    drop(file);
    staged.map_err(|e| format!("No se pudo guardar el archivo completo: {e}"))?;
    std::fs::rename(&temporary.0, path).map_err(|e| format!("No se pudo finalizar la copia; el destino anterior se conserva: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("contaez-export-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            Self(path.canonicalize().unwrap())
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let expected_parent=std::env::temp_dir().canonicalize().ok();
            if self.0.parent()==expected_parent.as_deref() && self.0.file_name().is_some_and(|s|s.to_string_lossy().starts_with("contaez-export-test-")) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }
    #[test]
    fn saves_and_replaces_unicode_paths_without_staging_files() {
        let directory = TestDirectory::new();
        let path = directory.0.join("Práctica de México.xlsx");
        write_atomic(&path, b"first complete workbook").unwrap();
        write_atomic(&path, b"second complete workbook").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second complete workbook");
        assert_eq!(std::fs::read_dir(&directory.0).unwrap().count(), 1);
    }
    #[test]
    fn failed_rename_preserves_destination_and_cleans_staging_file() {
        let directory = TestDirectory::new();
        let target = directory.0.join("Existing folder.xlsx");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("original"), b"preserve me").unwrap();
        assert!(write_atomic(&target, b"must not replace a folder").is_err());
        assert_eq!(std::fs::read(target.join("original")).unwrap(), b"preserve me");
        assert_eq!(std::fs::read_dir(&directory.0).unwrap().count(), 1);
    }
}
