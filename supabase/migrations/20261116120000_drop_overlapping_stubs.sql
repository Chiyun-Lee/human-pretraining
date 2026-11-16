-- Notes written before equation pieces were kept with their paragraph carry
-- "Continued" pointers drawn on top of the note they belong to. A real pointer
-- sits in another column and never overlaps a note, so any that does is removed.
delete from public.regions stub
using public.regions note
where stub.paper_id = note.paper_id
  and stub.page = note.page
  and stub.id <> note.id
  and stub.kind = 'detail'
  and (stub.bullets = '["← Continued"]'::jsonb or stub.bullets = '["Continues →"]'::jsonb)
  and note.kind <> 'detail'
  and stub.x0 < note.x1 and note.x0 < stub.x1
  and stub.y0 < note.y1 and note.y0 < stub.y1;
