import { AbilityProviderRegistry, defineAbilityProvider, need } from "../src/need.js";

const providers = new AbilityProviderRegistry().register(
  defineAbilityProvider({
    id: "example/connectors",
    kind: "connector",
    priority: 10,
    description: "Prepared application integrations",
    async discover({ intent }) {
      if (!intent.toLowerCase().includes("email")) return [];
      return [{ kind: "connector", id: "mail/send", ready: true, trusted: true, description: "Send an email" }];
    }
  })
);

console.log(await need("send an email", { providers }));
