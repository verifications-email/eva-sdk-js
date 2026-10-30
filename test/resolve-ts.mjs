// Lets `node --test` run the TypeScript sources as they are (Node >= 22.18
// strips types natively): an extensionless relative import from a .ts file
// resolves to the .ts file next to it. No build and no dependencies needed.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      /^\.\.?\//.test(specifier) &&
      !/\.[cm]?[jt]s$/.test(specifier) &&
      context.parentURL?.endsWith('.ts')
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
