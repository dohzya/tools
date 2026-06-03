class Recap < Formula
  desc "Configurable project status dashboard for AI assistants"
  homepage "https://github.com/dohzya/tools"
  version "0.3.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.3.1/recap-darwin-arm64"
      sha256 "6c49fda51f5b07e700705a4337b834b1075b694a836705e06cf8488691477671"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.3.1/recap-darwin-x86_64"
      sha256 "d39e8b514638e117229859b7b2c444628e8949b3ca460c35d1a4fe67e8cd6b5a"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.3.1/recap-linux-arm64"
      sha256 "300c55eeb493a03d3c388de7e6085b2af88673876e1ca3ddb7a31d9c3dd77c86"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.3.1/recap-linux-x86_64"
      sha256 "7e5ed63eda8485eb2827e38f521234dc6521f6433be38c33dc54dc153d0b6d2a"
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
