run:
    node scripts/serve.mjs

test:
    node --test tests/*.test.mjs

benchmark-fragments:
    node scripts/benchmark-fragments.mjs

check:
    for file in src/*.js scripts/*.mjs tests/*.mjs; do node --check "$file" || exit 1; done

format:
    npx --yes prettier@3.6.2 --write src scripts tests index.html style.css package.json README.md ITERATIONS.md EXPANSION.md
