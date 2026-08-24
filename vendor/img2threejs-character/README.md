# img2threejs-character runtime

This is the compiled CharacterIR runtime consumed by the showcase. It is kept
inside this checkout because the source plugin is not published to npm and a
CI checkout of `img2threejs-showcase` does not contain a sibling
`img2threejs-character` directory.

The package contains only the plugin's generated JavaScript and declaration
files. It contains no GLB, BIN, texture, or character-reference asset.
