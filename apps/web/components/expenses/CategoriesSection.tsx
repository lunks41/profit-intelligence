'use client';

import { useState } from 'react';
import type { CategoryListResponse, ExpenseClassName } from '@pi/contracts';
import { apiDelete, apiPost, apiPut } from '../../lib/api';
import { CLASS_LABEL, CLASS_OPTIONS, overlapWarning } from '../../lib/expense-class';
import { CardHeader } from '../common/CardHeader';
import { Modal } from '../common/Modal';
import { Dropdown } from '../dropdown';
import { FormActions, FormError, useAction } from '../settings/shared';
import { ScrollTable } from '../common/ScrollTable';

type Category = CategoryListResponse['categories'][number];

/**
 * The expense categories as a card: the list, an Add category button, and Edit and Archive on every row. Adding and
 * editing share one dialog (CategoryForm). The same card is used on Expenses and in Settings.
 */
export function CategoriesSection({
  categories,
  onChanged,
}: {
  categories: CategoryListResponse['categories'];
  onChanged: () => void;
}) {
  // none: closed; 'new': adding; a category: editing it
  const [dialog, setDialog] = useState<'new' | Category | null>(null);
  const del = useAction();
  return (
    <s-section>
      <s-stack gap="small">
        <CardHeader
          title="Categories"
          action={
            <s-button variant="primary" onClick={() => setDialog('new')}>
              Add category
            </s-button>
          }
        />
        <ScrollTable maxHeight="15rem">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Category</s-table-header>
              <s-table-header>Kind of cost</s-table-header>
              <s-table-header format="numeric">Expenses</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {categories.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>{c.name}</s-table-cell>
                  <s-table-cell>{CLASS_LABEL[c.class]}</s-table-cell>
                  <s-table-cell>{c.expenseCount}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300">
                      <s-button
                        variant="tertiary"
                        accessibilityLabel={`Edit ${c.name}`}
                        onClick={() => setDialog(c)}
                      >
                        Edit
                      </s-button>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        disabled={del.busy}
                        accessibilityLabel={`Archive ${c.name}`}
                        onClick={async () => {
                          if (await del.run(() => apiDelete(`/expenses/categories/${c.id}`)))
                            onChanged();
                        }}
                      >
                        Archive
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </ScrollTable>
        <FormError message={del.error} />
        <s-text color="subdued">
          Archiving hides a category from new expenses. Existing expenses keep their label.
        </s-text>
      </s-stack>
      {dialog && (
        <Modal
          heading={dialog === 'new' ? 'Add category' : `Edit ${dialog.name}`}
          onClose={() => setDialog(null)}
        >
          <s-section>
            <CategoryForm
              category={dialog === 'new' ? undefined : dialog}
              onCancel={() => setDialog(null)}
              onSaved={() => {
                setDialog(null);
                onChanged();
              }}
            />
          </s-section>
        </Modal>
      )}
    </s-section>
  );
}

/**
 * The one category form, for adding a category and for changing one. Adding takes a name and a kind of cost
 * (chosen from the name when left alone); changing shows the same two fields with the name greyed out, because a
 * category keeps its name and only its kind of cost can change.
 */
function CategoryForm({
  category,
  onSaved,
  onCancel,
}: {
  category?: Category;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = category !== undefined;
  const [name, setName] = useState(category?.name ?? '');
  const [cls, setCls] = useState<ExpenseClassName | ''>(category?.class ?? '');
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const nameOk = name.trim().length > 0 && name.trim().length <= 60;
  const warning = cls ? overlapWarning(cls) : null;

  async function save() {
    setTouched(true);
    if (!nameOk) return;
    const ok = category
      ? await run(() =>
          apiPut(`/expenses/categories/${category.id}`, { class: cls as ExpenseClassName }),
        )
      : await run(() =>
          apiPost('/expenses/categories', { name: name.trim(), ...(cls ? { class: cls } : {}) }),
        );
    if (ok) onSaved();
  }

  return (
    <s-stack gap="base">
      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(10.625rem, 1fr))"
        gap="base"
        alignItems="end"
      >
        <s-text-field
          label="Category name"
          placeholder="Software"
          value={name}
          disabled={editing}
          error={touched && !nameOk ? 'Enter a name' : undefined}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <Dropdown
          label="Kind of cost"
          value={cls}
          options={[
            ...(editing ? [] : [{ value: '', label: 'Choose from the name' }]),
            ...CLASS_OPTIONS,
          ]}
          onChange={(v) => setCls(v as ExpenseClassName | '')}
        />
      </s-grid>
      {warning && (
        <s-banner tone="info" heading="Could be counted twice">
          <s-paragraph>{warning}</s-paragraph>
        </s-banner>
      )}
      <FormError message={error} />
      <FormActions>
        <s-button onClick={onCancel}>Cancel</s-button>
        <s-button variant="primary" disabled={busy} onClick={() => void save()}>
          {editing ? 'Save change' : 'Save category'}
        </s-button>
      </FormActions>
    </s-stack>
  );
}
