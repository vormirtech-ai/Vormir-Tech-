#!/usr/bin/env python3
"""Point the generated Flutter Android build at a real signing key.

`flutter create` signs release builds with the debug key and leaves a TODO. This
rewrites that to the key.properties pattern from Flutter's own deployment docs,
so a build signed with your key can install over the previous one.

    python3 tool/enable_signing.py <build-dir>

Expects <build-dir>/android/key.properties to exist. Handles both the Kotlin
(build.gradle.kts) and Groovy (build.gradle) forms that Flutter has generated
over the years, and refuses to claim success if an edit did not land.
"""

import os
import sys

KTS_IMPORTS = """import java.io.FileInputStream
import java.util.Properties

"""

KTS_LOADER = """
// Signing key, supplied by the build pipeline via android/key.properties.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}
"""

KTS_SIGNING = """    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
            storeFile = keystoreProperties.getProperty("storeFile")?.let { file(it) }
            storePassword = keystoreProperties.getProperty("storePassword")
        }
    }

"""

GROOVY_LOADER = """
// Signing key, supplied by the build pipeline via android/key.properties.
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.withReader('UTF-8') { reader -> keystoreProperties.load(reader) }
}
"""

GROOVY_SIGNING = """    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
            storePassword keystoreProperties['storePassword']
        }
    }

"""


def fail(message):
    raise SystemExit("[signing] %s" % message)


def patch(path, kotlin):
    with open(path, encoding="utf-8") as handle:
        text = handle.read()

    if "keystoreProperties" in text:
        print("[signing] %s already wired up" % os.path.basename(path))
        return

    loader = KTS_LOADER if kotlin else GROOVY_LOADER
    signing = KTS_SIGNING if kotlin else GROOVY_SIGNING

    # 1. the property loader, above the android { } block
    marker = "\nandroid {"
    if marker not in text:
        fail("no `android {` block found in %s" % path)
    text = text.replace(marker, loader + marker, 1)

    # 2. imports (Kotlin DSL requires them at the very top of the file)
    if kotlin:
        text = KTS_IMPORTS + text

    # 3. the signing config, just above buildTypes { }
    if "    buildTypes {" not in text:
        fail("no `buildTypes {` block found in %s" % path)
    text = text.replace("    buildTypes {", signing + "    buildTypes {", 1)

    # 4. release builds use it instead of the debug key
    replacements = [
        ('signingConfig = signingConfigs.getByName("debug")',
         'signingConfig = signingConfigs.getByName("release")'),
        ("signingConfig signingConfigs.debug",
         "signingConfig signingConfigs.release"),
    ]
    switched = False
    for old, new in replacements:
        if old in text:
            text = text.replace(old, new, 1)
            switched = True
            break
    if not switched:
        fail("could not find the debug signingConfig line to replace in %s" % path)

    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)

    # 5. prove the edits are actually in the file
    with open(path, encoding="utf-8") as handle:
        written = handle.read()
    for needle in ("keystoreProperties", "signingConfigs", "release"):
        if needle not in written:
            fail("edit did not land: %r missing from %s" % (needle, path))

    print("[signing] wired %s to android/key.properties" % os.path.basename(path))


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: enable_signing.py <build-dir>")

    build = os.path.abspath(sys.argv[1])
    app = os.path.join(build, "android", "app")

    properties = os.path.join(build, "android", "key.properties")
    if not os.path.exists(properties):
        fail("android/key.properties not found — nothing to sign with")

    kts = os.path.join(app, "build.gradle.kts")
    groovy = os.path.join(app, "build.gradle")

    if os.path.exists(kts):
        patch(kts, kotlin=True)
    elif os.path.exists(groovy):
        patch(groovy, kotlin=False)
    else:
        fail("neither build.gradle.kts nor build.gradle found in %s" % app)


if __name__ == "__main__":
    main()
