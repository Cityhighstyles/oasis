//! Entry point for the Windows production binary.
//! Delegates entirely to lib.rs so the library crate can be tested independently.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run();
}
