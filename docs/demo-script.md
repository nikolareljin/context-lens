# Demo script

Demo input is labelled in the app; every model call in the demo is real. Names and numbers are fictional.

1. **Small talk**: four everyday lines. The counters climb, raw text sent stays at 0 B, the ledger is empty, the cards read "on device".
2. **References**: with the pinned topic "city bus fares", "They raised it again here last month." The card shows `here → Springfield` and `last month → October 2026`, and one clean question.
3. **Grounded card**: verdict, two sentences, sources and search suggestions, "in cloud, grounded". The ledger shows the exact text that was sent.
4. **Personal data**: "Call Mark at 555-0134 about the bus fare numbers." The number never reaches a question; the check is withheld or rewritten without it.
5. **Strict mode offline**: airplane mode; filtering continues on the phone.
6. **Diagnostics**: model status, the source reported for each call, latency, evaluation results.
