// Example schema used only by the "Load example" buttons. No generated or fake results live here.

import type { ColumnSchema, ConsistencyRule, Relationship, TableSchema } from './types';

const col = (c: ColumnSchema): ColumnSchema => c;

export const DEMO_SCHEMA: TableSchema[] = [
  {
    name: 'customers',
    columns: [
      col({ name: 'customer_id', type: 'integer', semanticType: 'Identifier', nullable: false, unique: true, privacyLevel: 'low' }),
      col({ name: 'name', type: 'string', semanticType: 'Person Name', nullable: false, unique: false, privacyLevel: 'high', privacyTransform: 'synthetic' }),
      col({ name: 'email', type: 'email', semanticType: 'Email', nullable: false, unique: true, privacyLevel: 'high', privacyTransform: 'synthetic' }),
      col({ name: 'phone', type: 'string', semanticType: 'Phone', nullable: true, unique: false, privacyLevel: 'high', privacyTransform: 'synthetic' }),
      col({ name: 'city', type: 'string', semanticType: 'City', nullable: true, unique: false, privacyLevel: 'medium' }),
      col({ name: 'country', type: 'string', semanticType: 'Country', nullable: false, unique: false, privacyLevel: 'low' }),
      col({ name: 'age', type: 'integer', semanticType: 'Age', nullable: true, unique: false, privacyLevel: 'medium' }),
      col({ name: 'created_at', type: 'datetime', semanticType: 'Date', nullable: false, unique: false, privacyLevel: 'low' }),
    ],
    rowCount: 100,
  },
  {
    name: 'orders',
    columns: [
      col({ name: 'order_id', type: 'integer', semanticType: 'Identifier', nullable: false, unique: true, privacyLevel: 'low' }),
      col({ name: 'customer_id', type: 'integer', semanticType: 'Identifier', nullable: false, unique: false, privacyLevel: 'low' }),
      col({ name: 'order_date', type: 'date', semanticType: 'Date', nullable: false, unique: false, privacyLevel: 'low' }),
      col({ name: 'status', type: 'string', semanticType: 'Status', nullable: false, unique: false, privacyLevel: 'low' }),
      col({ name: 'total_amount', type: 'float', semanticType: 'Currency', nullable: false, unique: false, privacyLevel: 'low' }),
    ],
    rowCount: 300,
  },
  {
    name: 'order_items',
    columns: [
      col({ name: 'item_id', type: 'integer', semanticType: 'Identifier', nullable: false, unique: true, privacyLevel: 'low' }),
      col({ name: 'order_id', type: 'integer', semanticType: 'Identifier', nullable: false, unique: false, privacyLevel: 'low' }),
      col({ name: 'sku', type: 'string', semanticType: 'Identifier', nullable: false, unique: false, privacyLevel: 'low' }),
      col({ name: 'quantity', type: 'integer', semanticType: 'Quantity', nullable: false, unique: false, privacyLevel: 'low' }),
      col({ name: 'unit_price', type: 'float', semanticType: 'Currency', nullable: false, unique: false, privacyLevel: 'low' }),
    ],
    rowCount: 750,
  },
];

/** "Load example" for the relational designer: customers → orders → order_items. */
export const EXAMPLE_RELATIONAL = {
  tables: DEMO_SCHEMA,
  relationships: [
    { id: 'ex_orders_customers', parentTable: 'customers', parentColumn: 'customer_id', childTable: 'orders', childColumn: 'customer_id', cardinality: '1:N', minChildren: 1, maxChildren: 5 },
    { id: 'ex_items_orders', parentTable: 'orders', parentColumn: 'order_id', childTable: 'order_items', childColumn: 'order_id', cardinality: '1:N', minChildren: 1, maxChildren: 4 },
  ] as Relationship[],
  rules: [
    { id: 'ex_order_total', parentTable: 'orders', parentColumn: 'total_amount', childTable: 'order_items', aggregate: 'SUM', terms: ['quantity', 'unit_price'] },
  ] as ConsistencyRule[],
};
