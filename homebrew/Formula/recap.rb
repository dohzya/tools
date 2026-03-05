class Recap < Formula
  desc "Configurable project status dashboard for AI assistants"
  homepage "https://github.com/dohzya/tools"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.1.0/recap-darwin-arm64"
      sha256 "PLACEHOLDER_MACOS_ARM64"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.1.0/recap-darwin-x86_64"
      sha256 "PLACEHOLDER_MACOS_X86_64"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.1.0/recap-linux-arm64"
      sha256 "PLACEHOLDER_LINUX_ARM64"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.1.0/recap-linux-x86_64"
      sha256 "PLACEHOLDER_LINUX_X86_64"
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
