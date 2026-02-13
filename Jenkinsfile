pipeline {
    agent none

    stages {
        stage('CI') {
            agent { label 'linux' }
            options { timeout(time: 10, unit: 'MINUTES') }
            steps {
                sh '''
                    export PATH="$HOME/.bun/bin:$PATH"
                    if ! command -v bun &>/dev/null; then
                        curl -fsSL https://bun.sh/install | bash
                    fi
                    bun install --frozen-lockfile
                    bun run check
                    bun run test
                '''
            }
        }

        stage('Build') {
            when {
                anyOf {
                    branch 'main'
                    buildingTag()
                }
            }
            parallel {
                stage('Linux') {
                    agent { label 'linux' }
                    options { timeout(time: 30, unit: 'MINUTES') }
                    steps {
                        sh '''
                            sudo apt-get update
                            sudo apt-get install -y \
                                libwebkit2gtk-4.1-dev \
                                libsoup-3.0-dev \
                                libayatana-appindicator3-dev \
                                librsvg2-dev \
                                patchelf \
                                libgtk-3-dev \
                                libjavascriptcoregtk-4.1-dev
                        '''
                        sh '''
                            export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"

                            if ! command -v bun &>/dev/null; then
                                curl -fsSL https://bun.sh/install | bash
                            fi

                            if ! command -v rustup &>/dev/null; then
                                curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
                            fi

                            if ! command -v cargo-tauri &>/dev/null; then
                                cargo install tauri-cli --locked
                            fi

                            bun install --frozen-lockfile
                            cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb
                        '''
                        stash includes: 'src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/*.deb', name: 'linux-deb'
                    }
                }

                stage('macOS') {
                    agent { label 'macos' }
                    options { timeout(time: 30, unit: 'MINUTES') }
                    steps {
                        sh '''
                            export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"

                            if ! command -v bun &>/dev/null; then
                                curl -fsSL https://bun.sh/install | bash
                            fi

                            if ! command -v rustup &>/dev/null; then
                                curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
                            fi

                            if ! command -v cargo-tauri &>/dev/null; then
                                cargo install tauri-cli --locked
                            fi

                            NATIVE_TRIPLE=$(rustc -vV | grep '^host:' | awk '{print $2}')
                            bun install --frozen-lockfile
                            cargo tauri build --target "$NATIVE_TRIPLE"
                        '''
                        stash includes: 'src-tauri/target/*/release/bundle/dmg/*.dmg', name: 'macos-dmg'
                    }
                }
            }
        }

        stage('Release') {
            when { buildingTag() }
            agent { label 'linux' }
            steps {
                sh 'rm -rf release-artifacts && mkdir release-artifacts'
                unstash 'linux-deb'
                unstash 'macos-dmg'
                sh '''
                    find src-tauri/target -name '*.deb' -exec cp {} release-artifacts/ \\;
                    find src-tauri/target -name '*.dmg' -exec cp {} release-artifacts/ \\;
                '''
                withCredentials([usernamePassword(credentialsId: 'github-pat', usernameVariable: 'GH_USER', passwordVariable: 'GITHUB_TOKEN')]) {
                    sh '''
                        REPO_SLUG=$(echo "$GIT_URL" | sed -E 's#.*github\\.com[:/]([^/]+/[^/.]+)(\\.git)?$#\\1#')
                        gh release create "$TAG_NAME" \
                            --repo "$REPO_SLUG" \
                            --draft \
                            --generate-notes \
                            release-artifacts/*
                    '''
                }
            }
        }
    }
}
