#![cfg(target_os = "macos")]

use std::ptr::NonNull;

use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};
use tauri::Emitter;

/// macOS virtual key code for Escape.
const KVK_ESCAPE: u16 = 53;

/// wry's `WryWebViewParent.keyDown:` hands every unmodified key press to
/// `mainMenu.performKeyEquivalent()` and drops it without checking the
/// return value (wry <= 0.55.1; upstream fix tauri-apps/wry#1711 unmerged
/// as of 2026-06-12), so bare Escape never reaches the DOM. Install an
/// AppKit local event monitor that sees the key BEFORE window dispatch,
/// mirrors it to the webview as a Tauri event, and passes the NSEvent
/// through unchanged — native behaviour (IME composition cancel, exit
/// fullscreen) keeps working, and nothing in wry's key routing is touched.
pub fn install(app_handle: tauri::AppHandle) {
    let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        let raw = event.as_ptr();
        let event_ref = unsafe { event.as_ref() };
        if event_ref.keyCode() == KVK_ESCAPE {
            let flags = event_ref.modifierFlags();
            let has_modifier = flags.intersects(
                NSEventModifierFlags::Command
                    | NSEventModifierFlags::Control
                    | NSEventModifierFlags::Option,
            );
            if !has_modifier {
                let _ = app_handle.emit("offisim-native-escape", ());
            }
        }
        raw
    });
    // The monitor must outlive the app; AppKit owns the registration and we
    // never remove it, so the returned token is intentionally leaked.
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &block)
    };
    std::mem::forget(monitor);
}
