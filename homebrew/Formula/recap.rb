class Recap < Formula
  desc "Configurable project status dashboard for AI assistants"
  homepage "https://github.com/dohzya/tools"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.1.0/recap-darwin-arm64"
      sha256 "abd5b7d0442ada0c2f87637f9b8feb1c0a3bda8ac3fba88726e49fc11f12cc17"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.1.0/recap-darwin-x86_64"
      sha256 "1ac3ba5f1871c16560e514f506c3d67c3c659ce6ded6369ce88c61a00e95cb7e"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.1.0/recap-linux-arm64"
      sha256 "79b715a2656435b772bbdfedda5770bd383d02597fd89e9acf823b936ccc7c70"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.1.0/recap-linux-x86_64"
      sha256 "908f584f73440e9f4ae06f5f6b66ee2fab793166b38873dc6c6b450a4dd7018e"
    end
  end

  def install
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "recap-darwin-arm64"
      else
        "recap-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "recap-linux-arm64"
      else
        "recap-linux-x86_64"
      end
    end

    bin.install binary_name => "recap"
  end

  test do
    system "#{bin}/recap", "--help"
  end
end
