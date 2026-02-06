# Wall Tileset Guide (15-tile auto-tiling)

Place your 32x32 PNG images in the appropriate folder:
- `rock/` - Cave theme walls
- `brick/` - Dungeon theme walls
- `obsidian/` - Lava theme walls
- `tree/` - Forest theme walls

## File Naming

Name your files `1.png` through `16.png` based on this pattern:

```
Pattern: [Top][Right][Bottom][Left]
1 = connected to wall, 0 = exposed edge
```

## Visual Layout (3x3 grid corners/edges)

```
 1.png   2.png   3.png
  TL     TOP      TR

 4.png   5.png   6.png
 LEFT   CENTER  RIGHT

 7.png   8.png   9.png
  BL    BOTTOM    BR
```

## All 16 Variants

| File | Pattern | Description | Exposed Edges |
|------|---------|-------------|---------------|
| 1.png | 0110 | Top-left corner | Top, Left |
| 2.png | 0111 | Top edge | Top |
| 3.png | 0011 | Top-right corner | Top, Right |
| 4.png | 1110 | Left edge | Left |
| 5.png | 1111 | Center/Interior | None (fully surrounded) |
| 6.png | 1011 | Right edge | Right |
| 7.png | 1100 | Bottom-left corner | Bottom, Left |
| 8.png | 1101 | Bottom edge | Bottom |
| 9.png | 1001 | Bottom-right corner | Bottom, Right |
| 10.png | 0010 | Top isolated | Top, Left, Right (only bottom connects) |
| 11.png | 0100 | Left isolated | Top, Bottom, Left (only right connects) |
| 12.png | 0001 | Right isolated | Top, Bottom, Right (only left connects) |
| 13.png | 1000 | Bottom isolated | Bottom, Left, Right (only top connects) |
| 14.png | 0101 | Horizontal strip | Top, Bottom |
| 15.png | 1010 | Vertical strip | Left, Right |
| 16.png | 0000 | Fully isolated | All sides exposed |

## Example

For a cave wall tileset, create these files in `rock/`:
```
images/walls/rock/1.png   (top-left corner)
images/walls/rock/2.png   (top edge)
images/walls/rock/3.png   (top-right corner)
... etc ...
images/walls/rock/16.png  (single isolated block)
```

## Tips

- **5.png (center)** is the most common - used for all interior walls
- Start with 1-9 (the basic 3x3) for a good base tileset
- 10-16 are special cases you can add later
- If an image is missing, the game falls back to procedural rendering
