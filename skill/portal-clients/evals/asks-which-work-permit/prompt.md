---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Abre um processo de autorização de residência para trabalho para o Bruno Mendes.

(Test setup: Google Sheets isn't connected in this environment. The portal sheet "Portal - Silva & Costa Advogados" is exported in the current folder as Settings.csv, Clients.csv, Cases.csv and People.csv; row 1 of each file is sheet row 1, line N is sheet row N. Treat those files as the sheet: read them instead of calling a Sheets tool. Instead of writing to the sheet, save every write you would make to writes.json as a list of {"range": "Cases!A5:N5", "values": [[...]]}, then reply to me as you would after writing. If you would ask me something before writing, don't create writes.json: just reply with your question.)

Input files: Settings.csv, Clients.csv, Cases.csv, People.csv
