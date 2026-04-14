import { defineConfig } from "tsdown";

export default defineConfig((options) => ({
	entry: ["src/**/*.ts"],
	clean: true,
	format: "esm",
	...options,
}));
	