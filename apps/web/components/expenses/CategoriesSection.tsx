'use client';

import { useState } from 'react';
import type { CategoryListResponse, ExpenseClassName } from '@pi/contracts';
import { apiDelete, apiPost, apiPut } from '../../lib/api';
import { CLASS_OPTIONS, overlapWarning } from '../../lib/expense-class';
import { Dropdown } from '../dropdown';
import { FormError, useAction } from '../settings/shared';

const FILTER_GRID = 'repeat(auto-fit, minmax(10.625rem, 1fr))';

/** Create and archive expense categories. The same list is used on Expenses and Settings. */
export function CategoriesSection({
  categories,
  onChanged,
}: {
  categories: CategoryListResponse['categories'];
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [cls, setCls] = useState<ExpenseClassName | ''>('');
  const add = useAction();
  const del = useAction();
  const setClass = useAction();
  return (
    <s-section heading="Categories">
      <s-stack gap="base">
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
                <s-table-cell>
                  <Dropdown
                    compact
                    label={`Kind of cost for ${c.name}`}
                    value={c.class}
                    options={CLASS_OPTIONS}
                    onChange={async (v) => {
                      if (
                        await setClass.run(() =>
                          apiPut(`/expenses/categories/${c.id}`, { class: v as ExpenseClassName }),
                        )
                      )
                        onChanged();
                    }}
                  />
                </s-table-cell>
                <s-table-cell>{c.expenseCount}</s-table-cell>
                <s-table-cell>
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
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        <FormError message={del.error} />
        <FormError message={setClass.error} />
        {categories
          .filter((c) => overlapWarning(c.class) !== null)
          .map((c) => (
            <s-banner key={c.id} tone="info" heading={`${c.name}: could be counted twice`}>
              <s-paragraph>{overlapWarning(c.class)}</s-paragraph>
            </s-banner>
          ))}
        <s-grid gridTemplateColumns={FILTER_GRID} gap="base" alignItems="end">
          <s-text-field
            label="New category"
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <Dropdown
            label="Kind of cost"
            value={cls}
            options={[{ value: '', label: 'Choose from the name' }, ...CLASS_OPTIONS]}
            onChange={(v) => setCls(v as ExpenseClassName | '')}
          />
          <s-button
            variant="primary"
            disabled={add.busy || name.trim() === ''}
            onClick={async () => {
              if (
                await add.run(() =>
                  apiPost('/expenses/categories', {
                    name: name.trim(),
                    ...(cls ? { class: cls } : {}),
                  }),
                )
              ) {
                setName('');
                setCls('');
                onChanged();
              }
            }}
          >
            Add category
          </s-button>
        </s-grid>
        <FormError message={add.error} />
        <s-text color="subdued">
          Archiving hides a category from new expenses. Existing expenses keep their label.
        </s-text>
      </s-stack>
    </s-section>
  );
}
