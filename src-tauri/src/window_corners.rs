//! Rounded corners for the app window on Windows and macOS.
//!
//! The window is undecorated (custom title bar), which on some systems leaves
//! it with square corners. This forces the system's rounded corners:
//!
//! - Windows 11: asks the Desktop Window Manager for its standard rounded
//!   corners (DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND, 8 px) and keeps
//!   the DWM shadow on. Windows draws them square again by itself when the
//!   window is maximized. Windows 10 has no rounded windows — the call just
//!   fails there and nothing changes.
//! - macOS: makes the window non-opaque with a clear background and rounds +
//!   clips its content view's layer (10 px, like standard macOS windows); the
//!   window shadow follows the rounded shape.
//!
//! Best effort: any failure is ignored (the window just keeps its corners).

/// macOS window corner radius (points), same as standard macOS windows.
#[cfg(target_os = "macos")]
const MAC_RADIUS: f64 = 10.0;

pub fn apply(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    windows_round(window);
    #[cfg(target_os = "macos")]
    mac_round(window);
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let _ = window;
}

#[cfg(target_os = "windows")]
fn windows_round(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND};

    // The DWM frame (shadow) is what Windows rounds on undecorated windows.
    let _ = window.set_shadow(true);
    let Ok(h) = window.hwnd() else { return };
    // Tauri may use a different `windows` crate version: rebuild our HWND type.
    let hwnd = HWND(h.0 as *mut core::ffi::c_void);
    let preference = DWMWCP_ROUND;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const _ as *const core::ffi::c_void,
            std::mem::size_of_val(&preference) as u32,
        );
    }
}

#[cfg(target_os = "macos")]
fn mac_round(window: &tauri::WebviewWindow) {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let Ok(ptr) = window.ns_window() else { return };
    let ns_window = ptr as *mut AnyObject;
    if ns_window.is_null() {
        return;
    }
    // AppKit must be touched on the main thread (setup runs there).
    unsafe {
        let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setOpaque: false];
        let _: () = msg_send![ns_window, setBackgroundColor: clear];

        let content: *mut AnyObject = msg_send![ns_window, contentView];
        if content.is_null() {
            return;
        }
        let _: () = msg_send![content, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![content, layer];
        if layer.is_null() {
            return;
        }
        let _: () = msg_send![layer, setCornerRadius: MAC_RADIUS];
        let _: () = msg_send![layer, setMasksToBounds: true];

        let _: () = msg_send![ns_window, setHasShadow: true];
        let _: () = msg_send![ns_window, invalidateShadow];
    }
}
