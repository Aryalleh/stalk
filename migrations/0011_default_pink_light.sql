-- The default look is now pink on light. A brand color saved as the old default blue follows along.
UPDATE settings SET value = '#ff5c93' WHERE key = 'brand_color' AND lower(value) = '#3b82f6';
