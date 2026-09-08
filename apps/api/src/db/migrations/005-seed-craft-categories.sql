-- Seeds the craft categories.
--
-- These must stay identical to CRAFT_CATEGORIES in @raxtan/shared, which the
-- frontend uses to render filters before it has talked to the API. An
-- integration test compares the two and fails if they drift, so this file and
-- that constant are edited together or not at all.
--
-- Ids are explicit and stable. Existing postings reference them, so an id is
-- never reused or renumbered; retiring a category means setting IS_ACTIVE to 0.

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (1, 'crochet', 'Crochet', 'Hooked yarn work: amigurumi, bouquets, wearables, and home pieces.', 1);

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (2, 'knitting', 'Knitting', 'Needle-knit garments, blankets, and accessories.', 2);

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (3, 'embroidery', 'Embroidery', 'Hand-stitched thread work on fabric, hoops, and apparel.', 3);

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (4, 'stitch-art', 'Stitch Art', 'Cross-stitch, needlepoint, and stitched portraiture.', 4);

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (5, 'weaving', 'Weaving', 'Handloom and backstrap weaving, inabel, banig, and rattan.', 5);

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (6, 'pottery', 'Pottery & Ceramics', 'Thrown and hand-built clay, glazed and fired.', 6);

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (7, 'painting', 'Handmade Painting', 'Original painted works on canvas, paper, wood, or walls.', 7);

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (8, 'sculpture', 'Sculpture', 'Carved, cast, and modelled three-dimensional work.', 8);

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (9, 'jewelry', 'Jewelry', 'Handmade beadwork, metalwork, resin, and wire pieces.', 9);

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (10, 'woodcraft', 'Woodcraft', 'Carving, joinery, turning, and finished wooden goods.', 10);

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (11, 'paper-craft', 'Paper Craft', 'Bookbinding, calligraphy, quilling, and paper florals.', 11);

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (12, 'candles-soap', 'Candles & Soap', 'Hand-poured candles, soaps, and small-batch home goods.', 12);

INSERT INTO craft_categories (id, slug, name, description, sort_order) VALUES
  (13, 'other', 'Other Handmade', 'Handmade and artisan work outside the categories above.', 13);
