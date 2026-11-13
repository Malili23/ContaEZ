mod oauth;
mod storage;
mod files;

use serde_json::Value;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use storage::Vault;

#[tauri::command]
fn projects_load(vault: State<'_, Vault>) -> Result<Vec<Value>, String> { vault.list("project") }

#[tauri::command]
fn project_save(vault: State<'_, Vault>, project: Value) -> Result<(), String> {
    if project.get("jurisdiction").and_then(Value::as_str) != Some("MX") || project.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("Proyecto incompatible con ContaEZ México.".into());
    }
    let id = project.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()).ok_or("El proyecto no tiene identificador.")?;
    vault.save("project", id, &project)
}

#[tauri::command]
fn project_delete(vault: State<'_, Vault>, id: String) -> Result<(), String> { vault.delete("project", &id) }

#[tauri::command]
async fn save_export(app: tauri::AppHandle, data: Vec<u8>, name: String) -> Result<Option<String>, String> {
    if data.len() > 250_000_000 { return Err("El archivo supera el límite de exportación de 250 MB.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let name = std::path::Path::new(&name).file_name().and_then(|s| s.to_str()).unwrap_or("ContaEZ.xlsx");
        let mut dialog = app.dialog().file().set_title("Guardar copia de ContaEZ").set_file_name(name);
        if let Ok(directory) = app.path().download_dir() { dialog = dialog.set_directory(directory); }
        if let Some(window) = app.get_webview_window("main") { dialog = dialog.set_parent(&window); }
        if name.to_ascii_lowercase().ends_with(".xlsx") { dialog = dialog.add_filter("Libro de Excel", &["xlsx"]); }
        let selected = dialog.blocking_save_file();
        let Some(selected) = selected else { return Ok(None); };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        files::write_atomic(&path, &data)?;
        Ok(Some(path.to_string_lossy().to_string()))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Enlace inválido.")?;
    if !matches!(parsed.scheme(), "https" | "http" | "mailto") { return Err("Tipo de enlace no permitido.".into()); }
    open::that(url).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let vault = Vault::open(dir).map_err(std::io::Error::other)?;
            app.manage(vault);
            app.manage(oauth::SessionLock::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![projects_load, project_save, project_delete, save_export, open_external,
            oauth::chatgpt_connect, oauth::chatgpt_status, oauth::chatgpt_ask, oauth::chatgpt_disconnect, oauth::google_export])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar ContaEZ. Revisa el almacén seguro del sistema y los permisos de la carpeta de datos.");
}
