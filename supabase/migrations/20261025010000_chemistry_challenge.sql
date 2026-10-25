-- Chemistry challenge drops. Players open /chem/:dropId, name elements and
-- easy formulas (H2O → water), then claim_drop with GPS/QR proof.

alter type drop_type add value if not exists 'chemistry';
