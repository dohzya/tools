class DzReview < Formula
  desc "Markdown review syntax scanner and helper CLI"
  homepage "https://github.com/dohzya/tools"
  version "0.4.2"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.4.2/dz-review-darwin-arm64"
      sha256 "3f6e2e13913b3abc53ee9819955ed83591d3a94494d99dbf5fea7fc94f7a3ee6"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.4.2/dz-review-darwin-x86_64"
      sha256 "57ead631305f2e43df448a1eec8fa0d2626f54d98204f76d40907222aac418dd"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.4.2/dz-review-linux-arm64"
      sha256 "13312711432b0ac5d1e0d31639c21b43ebecc62d6fe84afbc084598ed1deacbd"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.4.2/dz-review-linux-x86_64"
      sha256 "fdcec9adadb4a7aeaba8c8c2766deae9718617508809dfbeb01f62090887e822"
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
