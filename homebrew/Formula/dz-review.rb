class DzReview < Formula
  desc "Markdown review syntax scanner and helper CLI"
  homepage "https://github.com/dohzya/tools"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.1.0/dz-review-darwin-arm64"
      sha256 "37febfd96fc17cdcc09be91158dfd3d7d7d0d66139186efb6071d2edfe00e4b7"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.1.0/dz-review-darwin-x86_64"
      sha256 "136de246d8f027b853d37c3e5fc0ca7332c228c58b704d4b13717a64c64d1f85"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.1.0/dz-review-linux-arm64"
      sha256 "f1aa214778d67aee60fe7d61e6bffa9254296371360acfb88a677637b6dbf35e"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.1.0/dz-review-linux-x86_64"
      sha256 "fdb4a0dfd8eb3e1be85750a5dd38a8cb31c668a0c5b0376cf079208dbcc47a59"
    end
  end

  def install
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "dz-review-darwin-arm64"
      else
        "dz-review-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "dz-review-linux-arm64"
      else
        "dz-review-linux-x86_64"
      end
    end

    bin.install binary_name => "dz-review"
  end

  test do
    system "#{bin}/dz-review", "--help"
  end
end
