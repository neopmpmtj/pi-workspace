---
description: Check the DeepSeek credit balance against the alert thresholds
---
Run `~/.pi/agent/scripts/deepseek-balance.sh` from bash and report exactly the balance line
it prints. Add one short sentence comparing it to the monitor thresholds: a one-time warning
under USD 2.50, a persistent 30-minute alert under USD 2.00, silent at or above USD 2.50.
Nothing else.
