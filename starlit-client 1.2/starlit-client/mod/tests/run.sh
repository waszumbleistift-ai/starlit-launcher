#!/bin/sh
# Compiles and runs the Minecraft-free tests (JDK 21 required). Optional: pass a launcher theme.json for the contract test.
set -e
cd "$(dirname "$0")/.."
OUT="${TMPDIR:-/tmp}/starlit-pure-tests"
rm -rf "$OUT" && mkdir -p "$OUT"
javac -d "$OUT" src/main/java/dev/starlit/core/*.java tests/PureTests.java
java -cp "$OUT" PureTests "$@"
