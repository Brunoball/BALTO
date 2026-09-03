import { test } from './support/test.js';
import { uniqueName } from './support/data.js';
import { requireMutations } from './support/ui.js';
import {
  createEntity,
  editEntity,
  deactivateEntity,
  reactivateEntity,
  deleteEntity,
} from './support/entity-lifecycle.js';

for (const kind of ['cliente', 'proveedor']) {
  test(`@cuentas-corrientes @crud ${kind}: alta, edición, baja, reactivación y eliminación`, async ({ page }) => {
    await requireMutations(test, page);
    const original = uniqueName(`CC-${kind}`, 60);
    const edited = `${original}-EDITADO`.slice(0, 70);

    await createEntity(page, kind, original);
    await editEntity(page, kind, original, edited);
    await deactivateEntity(page, kind, edited);
    await reactivateEntity(page, kind, edited);
    await deleteEntity(page, kind, edited);
  });
}
