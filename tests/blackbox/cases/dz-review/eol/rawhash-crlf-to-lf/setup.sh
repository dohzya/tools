# An agent-answered conversation is "answered" when its rawHash changed since
# the session started. Converting the file CRLF -> LF is not a change.
printf '# T\r\n\r\n<!--\r\n@me%%2026-06-16T17:35:35+02:00 Q?\r\n@agent%%2026-06-16T17:36:35+02:00 A.\r\n-->\r\n' > d.md
$CMD_DZ_REVIEW session start d.md
sed -i 's/\r$//' d.md
