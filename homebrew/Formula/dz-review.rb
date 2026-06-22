class DzReview < Formula
  desc "Markdown review syntax scanner and helper CLI"
  homepage "https://github.com/dohzya/tools"
  version "0.2.2"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.2.2/dz-review-darwin-arm64"
      sha256 "43d242f8ad52ff3326b325f5a47a7278dbaa42a24ae5aad91ec1b7dc4ffc349a"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.2.2/dz-review-darwin-x86_64"
      sha256 "ce05c2a534cdcd4c6695c2446210b3a87023443280d10ecd88bc28e55cf4e6ea"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.2.2/dz-review-linux-arm64"
      sha256 "640840394f2a033de302fc8c34188aa2b89a508a52588745710d80f7bcab0959"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/dz-review-v0.2.2/dz-review-linux-x86_64"
      sha256 "1fdbb9225454ee2fc58fdde5d74f4c107d396cab079e1714903e97173fe108a3"
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
