# Tex Axes Ops

This repository contains the operational backend for Tex Axes:
- Booking finalization
- Lane capacity enforcement
- Stripe payment handling
- Rentals & BYOB logic

This system is intentionally isolated from Moral Clarity AI.
It is a standalone commerce and operations service.

## Key Properties
- Deterministic capacity control
- Stripe-idempotent payments
- No overbooking possible
- No AI dependencies

## Deployment
- Stripe webhook runs as a standalone Node service
- Database logic lives in Supabase (Tex Axes project only)
