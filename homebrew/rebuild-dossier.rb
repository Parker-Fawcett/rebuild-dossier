class RebuildDossier < Formula
  desc "Reverse-engineer a mutation-tested rebuild spec from an existing app"
  homepage "https://github.com/Parker-Fawcett/rebuild-dossier"
  url "https://registry.npmjs.org/rebuild-dossier/-/rebuild-dossier-0.2.6.tgz"
  sha256 "1af7a5f4d6487ff3bec670d955c07fc1c89473eafa3df87c9ff7e662f850a00b"
  license "MIT"
  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install "bin/rebuild-dossier"
  end

  test do
    system "#{bin}/rebuild-dossier", "--help"
  end
end
