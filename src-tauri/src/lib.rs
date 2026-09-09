/// The desktop shell.
///
/// It carries no business logic of its own: it hosts the same web build the
/// browser gets, so there is one codebase and one place for a bug to live. The
/// bundled build talks to the API with bearer tokens rather than cookies,
/// because Tauri serves the app from `tauri://localhost` and every API call is
/// therefore cross-site.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running RaxTan");
}
