// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use std::time::Duration;

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let shell = app.shell();

            // Spawn the maude-server sidecar
            let (mut rx, child) = shell
                .sidecar("maude-server")
                .expect("failed to create maude-server sidecar")
                .spawn()
                .expect("failed to spawn maude-server sidecar");

            // Store the child process so we can kill it on exit
            app.manage(SidecarState {
                child: std::sync::Mutex::new(Some(child)),
            });

            // Log sidecar output in a background task
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[maude-server] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[maude-server] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("[maude-server] terminated with status: {:?}", status);
                            break;
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("[maude-server] error: {}", err);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Poll /health until server is ready (up to 10 seconds)
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let client = reqwest::Client::new();
                let mut ready = false;

                for _ in 0..40 {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    match client.get("http://localhost:3002/health").send().await {
                        Ok(resp) if resp.status().is_success() => {
                            println!("[maude] server is ready");
                            ready = true;
                            break;
                        }
                        _ => continue,
                    }
                }

                if !ready {
                    eprintln!("[maude] server failed to start within 10 seconds");
                }

                // Emit ready event to frontend
                let _ = app_handle.emit("server-ready", ready);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill the sidecar when the window is closed
                if let Some(state) = window.try_state::<SidecarState>() {
                    if let Ok(mut guard) = state.child.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Maude");
}

struct SidecarState {
    child: std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}
