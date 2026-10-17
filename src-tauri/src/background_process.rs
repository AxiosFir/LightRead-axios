//! 后台 CLI 不应在 Windows GUI 应用里创建控制台窗口；重定向 stdio 本身不会禁止窗口。

use std::ffi::OsStr;
use std::process::Command;

pub(crate) fn command(program: impl AsRef<OsStr>) -> Command {
  #[allow(unused_mut)]
  let mut command = Command::new(program);
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
  }
  command
}

#[cfg(test)]
mod tests {
  use super::command;

  #[test]
  fn background_child_preserves_output_without_a_console() {
    const CHILD_MARKER: &str = "LIGHTREAD_BACKGROUND_PROCESS_TEST_CHILD";
    if std::env::var_os(CHILD_MARKER).is_some() {
      #[cfg(windows)]
      {
        #[link(name = "kernel32")]
        extern "system" {
          fn GetConsoleWindow() -> *mut std::ffi::c_void;
        }
        assert!(unsafe { GetConsoleWindow() }.is_null(), "background child has a console");
      }
      println!("background-stdout-ok");
      eprintln!("background-stderr-ok");
      return;
    }

    // 用测试程序自身作真实子进程，Windows 上同时检查控制台句柄与管道输出。
    let test_name = concat!(module_path!(), "::background_child_preserves_output_without_a_console");
    let test_name = test_name.split_once("::").unwrap().1;
    let output = command(std::env::current_exe().unwrap())
      .args(["--exact", test_name, "--nocapture"])
      .env(CHILD_MARKER, "1")
      .output()
      .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    assert!(String::from_utf8_lossy(&output.stdout).contains("background-stdout-ok"));
    assert!(String::from_utf8_lossy(&output.stderr).contains("background-stderr-ok"));
  }
}
