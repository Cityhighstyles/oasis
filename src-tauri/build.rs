fn main() {
    // Embed the UAC manifest so the binary requests Administrator elevation
    // on launch. Without this, FwpmEngineOpen0 returns ERROR_ACCESS_DENIED.
    #[cfg(windows)]
    {
        println!("cargo:rerun-if-changed=app.manifest");
        let mut res = tauri_build::WindowsAttributes::new();
        res = res.app_manifest(include_str!("app.manifest"));
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(res))
            .expect("failed to run tauri-build");
    }

    #[cfg(not(windows))]
    tauri_build::build();
}
