---
type: llm
focus: trace
weight: 1
---

writes.json never writes the doc_key, group_key or check columns, never writes based_on on the new Visa types row, never deletes or overwrites the existing PT-D7 and PT-AR-91 rows, and places new rows directly after the last real row of each tab (Visa types row 4, Document lists from row 7) at explicit ranges.
