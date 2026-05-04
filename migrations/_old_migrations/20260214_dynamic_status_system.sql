-- ═══════════════════════════════════════════════════════════════════════
-- Migration: Dynamic Status System for Invoices & Orders
-- Date: 2026-02-14
-- Purpose: Create status_groups, custom_statuses, and status_transitions
--          for purchase_invoice, purchase_order, sales_order
--          + enhance existing sales_invoice workflow
-- ═══════════════════════════════════════════════════════════════════════

-- ┌─────────────────────────────────────────────┐
-- │ purchase_invoice — 11 حالات + 19 تحول       │
-- │ purchase_order  — 7 حالات + 9 تحولات        │
-- │ sales_order     — 8 حالات + 10 تحولات       │
-- │ sales_invoice   — +3 حالات + 7 تحولات        │
-- └─────────────────────────────────────────────┘

-- Status Codes for Purchase Invoice:
-- draft → pending → approved → confirmed → received → posted → partially_paid → paid
-- (with: overdue, cancelled, rejected)

-- Status Codes for Purchase Order:
-- draft → sent → confirmed → partially_received → received → closed → cancelled

-- Status Codes for Sales Order:
-- draft → confirmed → processing → partially_delivered → delivered → invoiced → closed → cancelled

-- Status Codes for Sales Invoice (enhanced):
-- draft → pending → approved → posted → partially_paid → paid → cancelled → overdue

-- NOTE: This migration was already applied interactively in the current session.
-- It serves as a reference/documentation file.
-- To re-apply, run the DO $$ block from the conversation log.
