# Endfield HDR component

QAQR builds the existing `endfield` addon and ReShade with full addon support from
the checked-out organization forks. `RENODX_ADDON_FILTER=endfield` keeps the build
limited to this game. No game shaders are patched during packaging.

From the QAQR workspace, run `node tools/build-components.cjs endfield-hdr`.
The build needs Visual Studio 2022 C++ tools, a Windows SDK, CMake, Ninja and
Python. `QAQR_CMAKE`, `QAQR_NINJA`, `QAQR_PYTHON` and `QAQR_SLANG` may select local
tools. DXC, Slang and Python build packages are cached inside the workspace.

Output goes to `local-components/endfield-hdr`. The manifest records both source
commits and file hashes; the package contains licenses and no debug symbols.
QAQR installs it into `data/RenoDX/Endfield`, injects ReShade before EFMI through
the Launcher's Extra Libraries setting, and leaves consent signing to XXMI.

The ReShade fork's CMake target also builds the resource shaders, defines both
Unicode macros and links XInput, matching its Visual Studio project.
