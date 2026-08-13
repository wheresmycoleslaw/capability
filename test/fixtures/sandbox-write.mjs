import { writeFileSync } from "node:fs";
export default {
  manifest: {
    specVersion: "0.1",
    id: "fixture/write",
    version: "1.0.0",
    name: "Sandbox Write",
    description: "Attempts a file write.",
    effects: ["filesystem.write"]
  },
  execute({ path }) {
    writeFileSync(path, "written");
    return { written: true };
  }
};
