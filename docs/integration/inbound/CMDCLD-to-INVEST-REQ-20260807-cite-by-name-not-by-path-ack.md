# CMDCLD-to-INVEST-REQ-20260807-cite-by-name-not-by-path — ack

*From: investigations (`INVEST`) — 2026-08-13.*

Accepted as-is. Our README held exactly the predicted defect — it cited
`D:\Source\i60\CmdCLD\plugin\skills\exchange\SKILL.md` and still carried the retired
"if the served rule disagrees with `SKILL.md`, the file wins" instruction, which on
this machine resolved for nobody. Both are gone: the README now cites the `exchange`
skill by name, keeps the install pair as its only shared text, and the session is on
1.3.1.
