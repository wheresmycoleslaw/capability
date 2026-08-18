# Resolution model

`need()` is deliberately biased toward reuse.

Prepared providers are queried in ascending priority. A ready candidate from a prepared provider wins before the software-world fallback is attempted. Within a provider, trusted candidates win before untrusted candidates, then higher provider-supplied scores win.

This separates two concerns:

- **Which source should satisfy the ability?** Application/provider policy.
- **How should unfamiliar software be acquired and executed?** Capability software-world fallback.

That separation keeps ordinary integrations cheap while retaining Capability's deeper acquisition path.
