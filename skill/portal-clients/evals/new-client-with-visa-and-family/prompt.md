---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Adiciona a cliente Joana Lima, joana.lima@gmail.com, processo de visto D7. Vem com o marido, Rui Lima, nascido a 12/03/1980, e o filho Tomás Lima, nascido a 01/06/2012. Podes avançar sem me perguntar.

(Test setup: Google Sheets isn't connected in this environment. The portal sheet "Portal - Silva & Costa Advogados" is exported in the current folder as Settings.csv, Clients.csv, Cases.csv and People.csv; row 1 of each file is sheet row 1, line N is sheet row N. Treat those files as the sheet: read them instead of calling a Sheets tool. Instead of writing to the sheet, save every write you would make to writes.json as a list of {"range": "Cases!A5:N5", "values": [[...]]}, then reply to me as you would after writing. If you would ask me something before writing, don't create writes.json: just reply with your question.)

Input files: Settings.csv, Clients.csv, Cases.csv, People.csv
