' Launches a command completely hidden (no console window flash) --
' used by the desktop shortcut and by 啟動-桌面便利貼牆.bat itself when
' double-clicked directly, so the setup/log console doesn't have to stay
' visible once everything is already installed. There's an in-app close
' button now (top-right corner, either wall), so keeping this console open
' just to have a way to quit is no longer necessary.
'
' Usage: wscript run-hidden.vbs "<full path to .bat>" [extra args...]
' Kept pure ASCII on purpose -- WScript reads its own source in the system
' codepage, and the .bat's actual (non-ASCII) filename is passed in as a
' command-line argument instead of being hard-coded here, so encoding of
' this file never matters.
Set shell = CreateObject("WScript.Shell")
cmd = """" & WScript.Arguments(0) & """"
For i = 1 To WScript.Arguments.Count - 1
  cmd = cmd & " " & WScript.Arguments(i)
Next
shell.Run "cmd /c " & cmd, 0, False
