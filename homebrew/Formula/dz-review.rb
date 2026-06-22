class DzReview < Formula
  desc "Markdown review syntax scanner and helper CLI"
  homepage "https://github.com/dohzya/tools"
  version "0.2.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.2.0/dz-review-darwin-arm64"
      sha256 "e22c23acf323da3eb5c6b70f8b34df730974d3cfa83526929c6d041445de5fa1"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.2.0/dz-review-darwin-x86_64"
      sha256 "acac6ad68fdd6d6c2f03da7d1f41f85d8b458175a80ad7b09a629233453adacb"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.2.0/dz-review-linux-arm64"
      sha256 "35e86920871c7de76482eb885928608184a1bc6fe18afdbbf4805764d07a5562"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.2.0/dz-review-linux-x86_64"
      sha256 "1d79a396c4384d2b9f0ae9af3e7c4afd607541ef9cc491f3021e09de6c0c216e"
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
