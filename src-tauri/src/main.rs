// Hides the console window that would otherwise open behind the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    raxtan_lib::run()
}
