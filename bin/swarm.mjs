#!/usr/bin/env -S node --no-warnings
import { cli } from "../src/cli.ts";
await cli(process.argv.slice(2));
