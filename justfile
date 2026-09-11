run:
    node scripts/serve.mjs

test:
    node --test tests/*.test.mjs

check:
    node --check src/main.js
    node --check src/render.js
    node --check src/camera.js
    node --check src/physics.js
    node --check src/solar.js
    node --check src/math.js
    node --check scripts/serve.mjs

format:
    npx --yes prettier@3.6.2 --write src scripts tests index.html style.css package.json README.md ITERATIONS.md
