export default { resolve: { alias: [{ find: /^@\//, replacement: new URL('./apps/web/src/', import.meta.url).pathname }] }, test: { globals: true, include: ['apps/web/tests/fidelity/**'] } };
