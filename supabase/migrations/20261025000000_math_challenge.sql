-- Mental-math challenge drops. Players open /math/:dropId, solve a short set of
-- integer problems (subtract, divide, square root, fractions), then claim_drop
-- with GPS/QR proof — same path as check-in / photo hunt.

alter type drop_type add value if not exists 'math';
